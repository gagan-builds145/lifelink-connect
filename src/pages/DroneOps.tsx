import { api } from "@/convex/_generated/api";
import { DashboardShell } from "@/components/lifelink/DashboardShell";
import {
  NETWORK_MAP_NOTE,
  NetworkMap,
  type NetworkMapPoint,
  type NetworkMapRoute,
  type NetworkMapZone,
} from "@/components/lifelink/NetworkMap";
import { BloodGroupChip, StatCard } from "@/components/lifelink/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import { COMPONENT_LABELS, formatDateTime, formatRelative } from "@/lib/blood";
import { ROLE_LABELS, type AppRole } from "@/lib/roles";
import { MISSION_STATE_LABELS, storageRangeFor, type MissionState } from "@/lib/supply";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  BatteryCharging,
  CheckCircle2,
  ChevronRight,
  Cloud,
  Gauge,
  Loader2,
  MapPin,
  Package,
  Plane,
  Play,
  Plus,
  Radio,
  RefreshCcw,
  ShieldAlert,
  ShieldCheck,
  Thermometer,
  Timer,
  Upload,
  Wifi,
  WifiOff,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

function Section({
  title,
  eyebrow,
  action,
  children,
  className,
}: {
  title: string;
  eyebrow?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-2xl border border-border bg-card", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          {eyebrow && (
            <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-primary">{eyebrow}</p>
          )}
          <h2 className="mt-0.5 text-[13px] font-bold">{title}</h2>
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

const CHECK_TONE = {
  pass: { icon: CheckCircle2, className: "text-teal-600", label: "pass" },
  warn: { icon: AlertTriangle, className: "text-amber-600", label: "warn" },
  fail: { icon: XCircle, className: "text-rose-600", label: "fail" },
} as const;

const STATE_TONE = (state: string) => {
  if (["COMPLETED"].includes(state)) return "border-teal-200 bg-teal-50 text-teal-800";
  if (["HOLD", "EMERGENCY_LANDING"].includes(state)) return "border-rose-200 bg-rose-50 text-rose-800";
  if (["DELIVERED", "RETURNING_TO_BASE"].includes(state)) return "border-sky-200 bg-sky-50 text-sky-800";
  if (["ABORTED"].includes(state)) return "border-border bg-muted text-muted-foreground";
  return "border-amber-200 bg-amber-50 text-amber-800";
};

export default function DroneOps() {
  const { user } = useAuth();
  const overview = useQuery(api.drones.overview);
  const fleet = useQuery(api.drones.fleet);
  const missions = useQuery(api.drones.missions);
  const bases = useQuery(api.drones.listBases);
  const zones = useQuery(api.drones.listAirspaceZones);
  const facilities = useQuery(api.allocation.networkFacilities);
  const transfers = useQuery(api.allocation.transfersForMe);

  const [tab, setTab] = useState("live");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [transferChoice, setTransferChoice] = useState("");
  const [droneChoice, setDroneChoice] = useState("");
  const [routeAuthorized, setRouteAuthorized] = useState(true);
  const [containerTemp, setContainerTemp] = useState("4");
  const [deliveryCode, setDeliveryCode] = useState("");
  const [failureKind, setFailureKind] = useState<
    "battery" | "gps" | "link" | "weather" | "navigation" | "temperature" | "landing_zone"
  >("battery");
  const failureDetail = "Simulated failure injected from the operations console.";
  const [abortReason, setAbortReason] = useState("Mission cancelled by the operations supervisor.");
  const [busy, setBusy] = useState<string | null>(null);

  const [baseOrg, setBaseOrg] = useState("");
  const [baseName, setBaseName] = useState("");
  const [baseLat, setBaseLat] = useState("18.5158");
  const [baseLng, setBaseLng] = useState("73.8798");
  const [droneBase, setDroneBase] = useState("");
  const [droneModel, setDroneModel] = useState("AeroMed S2 (Simulated)");
  const [droneManufacturer, setDroneManufacturer] = useState("LifeLink SITL Lab");
  const [dronePayload, setDronePayload] = useState("4");
  const [droneBattery, setDroneBattery] = useState("94");
  const [droneCapacity, setDroneCapacity] = useState("420");
  const [droneRange, setDroneRange] = useState("32");
  const [droneSpeed, setDroneSpeed] = useState("54");
  const [droneController, setDroneController] = useState<"px4" | "ardupilot">("px4");
  const [zoneName, setZoneName] = useState("");
  const [zoneLat, setZoneLat] = useState("18.582");
  const [zoneLng, setZoneLng] = useState("73.919");
  const [zoneRadius, setZoneRadius] = useState("2.4");

  const planMission = useMutation(api.drones.planMission);
  const dispatchMission = useMutation(api.drones.dispatchMission);
  const confirmLoading = useMutation(api.drones.confirmLoading);
  const confirmDelivery = useMutation(api.drones.confirmDelivery);
  const abortMission = useMutation(api.drones.abortMission);
  const reportFailure = useMutation(api.drones.reportFailure);
  const updateDrone = useMutation(api.drones.updateDrone);
  const registerBase = useMutation(api.drones.registerBase);
  const registerDrone = useMutation(api.drones.registerDrone);
  const addZone = useMutation(api.drones.addAirspaceZone);

  const canOperate = user?.role === "drone_ops" || user?.role === "admin";
  const role = (user?.role ?? "drone_ops") as AppRole;

  const selectedMission = useMemo(
    () => (missions ?? []).find((m) => String(m._id) === selectedId) ?? null,
    [missions, selectedId],
  );
  const detail = useQuery(
    api.drones.missionDetail,
    selectedMission ? { missionId: selectedMission._id } : "skip",
  );

  useEffect(() => {
    if (!selectedId && (missions ?? []).length > 0) {
      const active = (missions ?? []).find(
        (m) => !["COMPLETED", "ABORTED"].includes(m.state),
      );
      setSelectedId(String((active ?? missions![0])._id));
    }
  }, [missions, selectedId]);

  useEffect(() => {
    if (detail?.mission.deliveryCode) setDeliveryCode(detail.mission.deliveryCode);
  }, [detail?.mission.deliveryCode]);

  const availableTransfers = (transfers ?? []).filter(
    (t) => ["reserved", "approved"].includes(t.status),
  );
  const availableDrones = (fleet ?? []).filter(
    (d) => d.status === "available" && d.maintenanceStatus !== "grounded",
  );

  const mapPoints: NetworkMapPoint[] = useMemo(() => {
    const points: NetworkMapPoint[] = [];
    for (const facility of facilities ?? []) {
      if (facility.latitude == null || facility.longitude == null) continue;
      points.push({
        id: `facility-${facility._id}`,
        lat: facility.latitude,
        lng: facility.longitude,
        label: facility.name,
        kind: "facility",
        detail: `${facility.type.replace("_", " ")} · ${facility.city}`,
      });
    }
    for (const base of bases ?? []) {
      points.push({
        id: `base-${base._id}`,
        lat: base.latitude,
        lng: base.longitude,
        label: base.name,
        kind: "base",
        detail: `Drone base · ${base.city}`,
      });
    }
    for (const drone of fleet ?? []) {
      points.push({
        id: `drone-${drone._id}`,
        lat: drone.currentLat,
        lng: drone.currentLng,
        label: `${drone.droneId} · ${drone.model}`,
        kind: "drone",
        detail: `${drone.batteryPct}% · ${drone.status} · ${drone.linkStatus}`,
        active: true,
      });
    }
    return points;
  }, [facilities, bases, fleet]);

  const mapRoutes: NetworkMapRoute[] = useMemo(() => {
    if (!detail) return [];
    return [
      {
        id: detail.mission.missionId,
        points: detail.mission.route.map((w) => [w.lat, w.lng] as [number, number]),
        color: "#b21f34",
        label: `${detail.mission.missionId} · ${detail.mission.totalKm} km round trip`,
      },
    ];
  }, [detail]);

  const mapZones: NetworkMapZone[] = useMemo(
    () =>
      (zones ?? [])
        .filter((z) => z.active && z.kind === "restricted")
        .map((z) => ({
          id: String(z._id),
          lat: z.centerLat,
          lng: z.centerLng,
          radiusKm: z.radiusKm,
          label: z.name,
        })),
    [zones],
  );

  const runPlan = async () => {
    const transfer = availableTransfers.find((t) => String(t._id) === transferChoice);
    const drone = availableDrones.find((d) => String(d._id) === droneChoice);
    if (!transfer || !drone) {
      toast.error("Choose a reserved transfer and an available drone.");
      return;
    }
    setBusy("plan");
    try {
      const result = await planMission({
        transferId: transfer._id,
        droneId: drone._id,
        routeAuthorized,
        landingZoneAvailable: true,
        containerTempC: Number(containerTemp) || 4,
        authorizationRef: routeAuthorized ? "SIMULATED-CORRIDOR-001" : undefined,
      });
      toast[result.passed ? "success" : "error"](
        result.passed ? `Preflight passed · ${result.missionCode}` : `Preflight held · ${result.missionCode}`,
        {
          description: result.passed
            ? `${result.routeKm} km round trip, ~${result.estimatedDurationMin} min. Dispatch requires a separate confirmation.`
            : "One or more critical checks failed. Inspect the checklist and abort or correct the drone.",
        },
      );
      setSelectedId(String(result.missionId));
      setTab("live");
    } catch (error) {
      toast.error("Could not create the mission", {
        description: error instanceof Error ? error.message : "Try again.",
      });
    } finally {
      setBusy(null);
    }
  };

  const act = async (key: string, fn: () => Promise<unknown>, success: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(success);
    } catch (error) {
      toast.error("Action blocked", {
        description: error instanceof Error ? error.message : "Try again.",
      });
    } finally {
      setBusy(null);
    }
  };

  const navItems = [
    { key: "live", label: "Live operations", icon: Plane, badge: overview?.activeMissions },
    { key: "fleet", label: "Fleet & bases", icon: Gauge, badge: overview?.maintenance },
    { key: "airspace", label: "Airspace", icon: Cloud },
  ];

  return (
    <DashboardShell
      roleLabel={ROLE_LABELS[role] ?? "Drone operations"}
      roleKey={user?.name ?? "Uncrewed logistics"}
      title="Drone operations control"
      subtitle="Plan, validate, dispatch and monitor facility-to-facility blood transport missions in software-in-the-loop simulation."
      items={navItems}
      active={tab}
      onSelect={setTab}
      demoData
      accentIcon={Plane}
      quickLinks={[
        { label: "Supply command", href: "/supply", icon: Package },
        { label: "Admin console", href: "/admin/dashboard", icon: ShieldCheck },
        { label: "Public blood search", href: "/blood-search", icon: MapPin },
      ]}
    >
      <div className="mb-4 flex flex-col gap-2 rounded-2xl border border-amber-300/70 bg-amber-50/70 p-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-start gap-2 text-[10.5px] leading-5 text-amber-900">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>
            <strong>Simulation only.</strong> No PX4/ArduPilot vehicle is connected and no real
            aircraft is commanded. Real operations require DGCA approval, airspace clearance,
            certified aircraft, a remote pilot and operational safety validation.
          </span>
        </p>
        <span className="shrink-0 rounded-full border border-amber-300 bg-white/60 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.1em] text-amber-800">
          SITL · not a flight
        </span>
      </div>

      <div className="mb-5 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Active missions"
          value={overview?.activeMissions ?? "—"}
          hint={`${overview?.holds ?? 0} hold · ${overview?.emergencies ?? 0} emergency`}
          icon={Plane}
          tone="primary"
        />
        <StatCard
          label="Fleet available"
          value={`${overview?.available ?? 0}/${overview?.fleet ?? 0}`}
          hint={`${overview?.charging ?? 0} charging · ${overview?.maintenance ?? 0} grounded`}
          icon={BatteryCharging}
          tone="teal"
        />
        <StatCard
          label="Units delivered"
          value={overview?.deliveredUnits ?? "—"}
          hint={`${overview?.completed ?? 0} completed simulation(s)`}
          icon={Package}
        />
        <StatCard
          label="Safety events"
          value={(overview?.holds ?? 0) + (overview?.emergencies ?? 0)}
          hint="Holds and emergency landings recorded"
          icon={ShieldAlert}
          tone="amber"
        />
      </div>

      {tab === "live" && (
        <div className="grid gap-4 xl:grid-cols-[330px_1fr]">
          <div className="space-y-4">
            <Section eyebrow="Mission planner" title="Transfer → drone → preflight">
              {!canOperate ? (
                <p className="text-[10.5px] leading-5 text-muted-foreground">
                  View-only. Mission planning and dispatch are restricted to the drone operations
                  role and administrators.
                </p>
              ) : availableTransfers.length === 0 ? (
                <p className="text-[10.5px] leading-5 text-muted-foreground">
                  No reserved transfer is waiting for transport. Run automatic allocation from the{" "}
                  <a href="/supply" className="font-semibold text-primary hover:underline">
                    supply command
                  </a>{" "}
                  first.
                </p>
              ) : (
                <div className="space-y-2">
                  <label className="block text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                    Reserved transfer
                  </label>
                  <select
                    value={transferChoice}
                    onChange={(event) => setTransferChoice(event.target.value)}
                    className="h-9 w-full rounded-lg border border-border bg-background px-2 text-[10.5px]"
                  >
                    <option value="">Choose transfer…</option>
                    {availableTransfers.map((t) => (
                      <option key={t._id} value={String(t._id)}>
                        {t.transferId} · {t.units} × {t.bloodGroup} {COMPONENT_LABELS[t.component]}
                      </option>
                    ))}
                  </select>
                  <label className="block text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                    Available drone
                  </label>
                  <select
                    value={droneChoice}
                    onChange={(event) => setDroneChoice(event.target.value)}
                    className="h-9 w-full rounded-lg border border-border bg-background px-2 text-[10.5px]"
                  >
                    <option value="">Choose drone…</option>
                    {availableDrones.map((d) => (
                      <option key={d._id} value={String(d._id)}>
                        {d.droneId} · {d.model} · {d.batteryPct}% · {d.baseName}
                      </option>
                    ))}
                  </select>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                        Container temp °C
                      </label>
                      <Input
                        value={containerTemp}
                        onChange={(event) => setContainerTemp(event.target.value)}
                        className="mt-1 h-8 text-[11px]"
                      />
                    </div>
                    <label className="mt-4 flex items-start gap-1.5 text-[9.5px] leading-4 text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={routeAuthorized}
                        onChange={(event) => setRouteAuthorized(event.target.checked)}
                        className="mt-0.5"
                      />
                      Simulated corridor authorisation recorded
                    </label>
                  </div>
                  <Button
                    size="sm"
                    className="w-full gap-1.5 text-[10.5px]"
                    onClick={() => void runPlan()}
                    disabled={busy === "plan" || !transferChoice || !droneChoice}
                  >
                    {busy === "plan" ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <ShieldCheck className="size-3.5" />
                    )}
                    Validate & plan mission
                  </Button>
                  <p className="text-[9px] leading-4 text-muted-foreground">
                    The drone must be based at the supplying facility. Preflight blocks dispatch for
                    battery, payload, range, GPS, link, weather, airspace, landing zone, return
                    capability or container temperature failures.
                  </p>
                </div>
              )}
            </Section>

            <Section eyebrow="Mission queue" title="Recent and active missions">
              {missions === undefined ? (
                <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Loading…
                </div>
              ) : missions.length === 0 ? (
                <p className="py-6 text-center text-[10.5px] text-muted-foreground">
                  No missions planned yet.
                </p>
              ) : (
                <div className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
                  {missions.map((m) => (
                    <button
                      key={m._id}
                      type="button"
                      onClick={() => setSelectedId(String(m._id))}
                      className={cn(
                        "w-full rounded-xl border p-2.5 text-left transition-colors",
                        String(m._id) === selectedId
                          ? "border-primary/30 bg-primary/[0.045]"
                          : "border-border bg-background hover:border-primary/20",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[10px] font-bold">{m.missionId}</p>
                        <span
                          className={cn(
                            "rounded-full border px-1.5 py-0.5 text-[8px] font-bold uppercase",
                            STATE_TONE(m.state),
                          )}
                        >
                          {MISSION_STATE_LABELS[m.state as MissionState] ?? m.state}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-[9px] text-muted-foreground">
                        {m.pickupName} → {m.dropoffName}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1 text-[8.5px] text-muted-foreground">
                        <Plane className="size-2.5" /> {m.droneCode} · {m.units} unit(s) ·{" "}
                        {formatRelative(m.updatedAt)}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </Section>
          </div>

          <div className="space-y-4">
            <Section
              eyebrow="Geospatial operations"
              title="Facilities, fleet and route"
              action={
                <span className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" /> Simulated
                  telemetry
                </span>
              }
            >
              <NetworkMap points={mapPoints} routes={mapRoutes} zones={mapZones} height={330} />
              <div className="mt-2 flex flex-wrap items-center gap-3 text-[9px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="size-2 rounded-full bg-teal-600" /> Facility
                </span>
                <span className="flex items-center gap-1">
                  <span className="size-2 rounded-full bg-blue-700" /> Drone
                </span>
                <span className="flex items-center gap-1">
                  <span className="size-2 rounded-full bg-slate-900" /> Base
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-px w-4 bg-primary" /> Planned corridor
                </span>
                <span className="flex items-center gap-1">
                  <span className="size-2 rounded-full border border-amber-600 bg-amber-100" />{" "}
                  Restricted zone (sim)
                </span>
              </div>
              <p className="mt-1.5 text-[9px] leading-4 text-muted-foreground">{NETWORK_MAP_NOTE}</p>
            </Section>

            {!selectedMission ? (
              <Section eyebrow="Mission control" title="Select a mission">
                <p className="py-8 text-center text-[10.5px] text-muted-foreground">
                  Choose a mission from the queue or create one from a reserved transfer.
                </p>
              </Section>
            ) : detail === undefined ? (
              <Section eyebrow="Mission control" title={selectedMission.missionId}>
                <div className="flex items-center gap-2 py-8 text-xs text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Loading mission…
                </div>
              </Section>
            ) : detail === null ? (
              <Section eyebrow="Mission control" title={selectedMission.missionId}>
                <p className="py-6 text-center text-[10.5px] text-muted-foreground">
                  Your facility is not part of this mission.
                </p>
              </Section>
            ) : (
              <>
                <Section
                  eyebrow="Mission control"
                  title={`${detail.mission.missionId} · ${detail.pickup?.name} → ${detail.dropoff?.name}`}
                  action={
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[8.5px] font-bold uppercase",
                        STATE_TONE(detail.mission.state),
                      )}
                    >
                      {MISSION_STATE_LABELS[detail.mission.state as MissionState] ??
                        detail.mission.state}
                    </span>
                  }
                >
                  <div className="grid gap-3 lg:grid-cols-[1.05fr_0.95fr]">
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-1.5">
                        <div className="rounded-lg bg-muted/30 p-2">
                          <p className="text-[8px] uppercase tracking-[0.08em] text-muted-foreground">
                            Payload
                          </p>
                          <p className="text-[11px] font-bold">
                            {detail.mission.units} unit(s) · {detail.mission.payloadKg} kg
                          </p>
                        </div>
                        <div className="rounded-lg bg-muted/30 p-2">
                          <p className="text-[8px] uppercase tracking-[0.08em] text-muted-foreground">
                            Round trip
                          </p>
                          <p className="text-[11px] font-bold">{detail.mission.totalKm} km</p>
                        </div>
                        <div className="rounded-lg bg-muted/30 p-2">
                          <p className="text-[8px] uppercase tracking-[0.08em] text-muted-foreground">
                            Battery
                          </p>
                          <p className="text-[11px] font-bold">
                            {detail.mission.telemetry?.batteryPct ?? detail.drone?.batteryPct ?? "—"}%
                          </p>
                        </div>
                        <div className="rounded-lg bg-muted/30 p-2">
                          <p className="text-[8px] uppercase tracking-[0.08em] text-muted-foreground">
                            Container
                          </p>
                          <p className="text-[11px] font-bold">
                            {detail.mission.telemetry?.tempC ?? detail.mission.containerTempC} °C ·{" "}
                            {storageRangeFor(detail.mission.component).label}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5 text-[9px]">
                        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1">
                          <Radio className="size-2.5" />
                          {detail.mission.telemetry?.linkStatus ?? detail.drone?.linkStatus ?? "—"}
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1">
                          <Timer className="size-2.5" /> ETA ~{detail.mission.estimatedDurationMin}{" "}
                          min
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1">
                          <Upload className="size-2.5" /> {detail.drone?.flightController ?? "px4"}{" "}
                          · simulated
                        </span>
                        {detail.mission.telemetry && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1">
                            <Gauge className="size-2.5" /> {detail.mission.telemetry.altitudeM} m ·{" "}
                            {detail.mission.telemetry.speedKmh} km/h
                          </span>
                        )}
                      </div>
                      <div className="rounded-xl border border-border bg-background p-2.5">
                        <p className="flex items-center justify-between text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                          Handoff evidence
                          <ShieldCheck className="size-3 text-primary" />
                        </p>
                        <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                          The receiver confirms with a one-time code. A mission can never be recorded
                          as delivered without it (admin override is audited).
                        </p>
                        {detail.mission.deliveryEvidence ? (
                          <p className="mt-1 text-[9px] font-semibold text-teal-700">
                            Verified · {formatDateTime(detail.mission.deliveryEvidence.confirmedAt)} ·
                            code {detail.mission.deliveryEvidence.code}
                          </p>
                        ) : detail.mission.deliveryCode ? (
                          <p className="mt-1 font-mono text-[13px] font-bold tracking-[0.2em] text-foreground">
                            {detail.mission.deliveryCode}
                          </p>
                        ) : (
                          <p className="mt-1 text-[9px] text-muted-foreground">
                            Code visible to the receiving facility and operations only.
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="rounded-xl border border-border bg-background p-2.5">
                      <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                        Preflight checklist · {detail.mission.preflight.filter((c) => c.status === "pass").length}/
                        {detail.mission.preflight.length} passed
                      </p>
                      <div className="mt-1.5 max-h-[300px] space-y-1 overflow-y-auto pr-1">
                        {detail.mission.preflight.length === 0 ? (
                          <p className="py-4 text-center text-[9.5px] text-muted-foreground">
                            Historical mission — checklist retained in the flight log.
                          </p>
                        ) : (
                          detail.mission.preflight.map((check) => {
                            const tone = CHECK_TONE[check.status];
                            const Icon = tone.icon;
                            return (
                              <div key={check.key} className="flex items-start gap-1.5">
                                <Icon className={cn("mt-0.5 size-3 shrink-0", tone.className)} />
                                <div>
                                  <p className="text-[9.5px] font-semibold leading-4">
                                    {check.label}{" "}
                                    <span className="font-normal text-muted-foreground">
                                      · {tone.label}
                                    </span>
                                  </p>
                                  <p className="text-[8.5px] leading-3.5 text-muted-foreground">
                                    {check.detail}
                                  </p>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>

                  {canOperate && (
                    <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3">
                      {detail.mission.state === "PREFLIGHT_PASSED" && (
                        <Button
                          size="sm"
                          className="h-8 gap-1.5 text-[10px]"
                          onClick={() =>
                            void act(
                              "dispatch",
                              () => dispatchMission({ missionId: detail.mission._id }),
                              "Simulated mission dispatched to pickup.",
                            )
                          }
                          disabled={busy === "dispatch"}
                        >
                          <Play className="size-3" /> Dispatch
                        </Button>
                      )}
                      {detail.mission.state === "PAYLOAD_LOADING" && (
                        <div className="flex items-end gap-1.5">
                          <div>
                            <label className="block text-[8.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                              Container °C
                            </label>
                            <Input
                              value={containerTemp}
                              onChange={(event) => setContainerTemp(event.target.value)}
                              className="mt-0.5 h-8 w-20 text-[11px]"
                            />
                          </div>
                          <Button
                            size="sm"
                            className="h-8 gap-1.5 text-[10px]"
                            onClick={() =>
                              void act(
                                "load",
                                () =>
                                  confirmLoading({
                                    missionId: detail.mission._id,
                                    containerTempC: Number(containerTemp) || 4,
                                    note: "Payload loading confirmed in simulation.",
                                  }),
                                "Payload loaded. Transit starts on the next telemetry tick.",
                              )
                            }
                            disabled={busy === "load"}
                          >
                            <Package className="size-3" /> Confirm loading
                          </Button>
                        </div>
                      )}
                      {detail.mission.state === "AT_DESTINATION" && (
                        <div className="flex items-end gap-1.5">
                          <div>
                            <label className="block text-[8.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                              Handoff code
                            </label>
                            <Input
                              value={deliveryCode}
                              onChange={(event) => setDeliveryCode(event.target.value)}
                              className="mt-0.5 h-8 w-28 font-mono text-[11px] tracking-[0.15em]"
                              placeholder="123456"
                            />
                          </div>
                          <Button
                            size="sm"
                            className="h-8 gap-1.5 text-[10px]"
                            onClick={() =>
                              void act(
                                "deliver",
                                () =>
                                  confirmDelivery({
                                    missionId: detail.mission._id,
                                    code: deliveryCode,
                                    note: "Delivery verified in simulation.",
                                  }),
                                "Delivery verified. Return-to-base will begin.",
                              )
                            }
                            disabled={busy === "deliver"}
                          >
                            <CheckCircle2 className="size-3" /> Verify delivery
                          </Button>
                        </div>
                      )}
                      {!["COMPLETED", "ABORTED"].includes(detail.mission.state) && (
                        <div className="flex items-end gap-1.5">
                          <div>
                            <label className="block text-[8.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                              Failure drill
                            </label>
                            <select
                              value={failureKind}
                              onChange={(event) => setFailureKind(event.target.value as typeof failureKind)}
                              className="mt-0.5 h-8 rounded-lg border border-border bg-background px-1.5 text-[10px]"
                            >
                              <option value="battery">Battery low</option>
                              <option value="gps">GPS loss</option>
                              <option value="link">Link loss</option>
                              <option value="weather">Weather</option>
                              <option value="navigation">Navigation</option>
                              <option value="temperature">Temperature</option>
                              <option value="landing_zone">Landing zone</option>
                            </select>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1 text-[10px] text-rose-700"
                            onClick={() =>
                              void act(
                                "failure",
                                () =>
                                  reportFailure({
                                    missionId: detail.mission._id,
                                    kind: failureKind,
                                    detail: failureDetail,
                                  }),
                                "Failure recorded and safety response applied.",
                              )
                            }
                            disabled={busy === "failure"}
                          >
                            <ShieldAlert className="size-3" /> Inject
                          </Button>
                        </div>
                      )}
                      {!["COMPLETED", "ABORTED"].includes(detail.mission.state) && (
                        <div className="flex items-end gap-1.5">
                          <div>
                            <label className="block text-[8.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                              Abort reason
                            </label>
                            <Input
                              value={abortReason}
                              onChange={(event) => setAbortReason(event.target.value)}
                              className="mt-0.5 h-8 w-48 text-[10px]"
                            />
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1 text-[10px]"
                            onClick={() =>
                              void act(
                                "abort",
                                () =>
                                  abortMission({
                                    missionId: detail.mission._id,
                                    reason: abortReason,
                                  }),
                                "Mission aborted and recorded.",
                              )
                            }
                            disabled={busy === "abort"}
                          >
                            <XCircle className="size-3" /> Abort
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  {detail.mission.failure && (
                    <div className="mt-2 rounded-xl border border-rose-200 bg-rose-50 p-2 text-[9.5px] leading-4 text-rose-900">
                      <strong className="uppercase">{detail.mission.failure.kind}</strong> recorded{" "}
                      {formatDateTime(detail.mission.failure.at)} — {detail.mission.failure.detail}
                    </div>
                  )}
                </Section>

                <Section eyebrow="Flight log" title="State transitions">
                  <div className="max-h-[240px] space-y-1.5 overflow-y-auto pr-1">
                    {detail.events.length === 0 ? (
                      <p className="py-4 text-center text-[10px] text-muted-foreground">
                        No events recorded yet.
                      </p>
                    ) : (
                      detail.events.map((event) => (
                        <div key={event._id} className="flex items-start gap-2">
                          <span className="mt-1 flex size-2 shrink-0 rounded-full bg-primary/70" />
                          <div className="min-w-0">
                            <p className="text-[9.5px] font-semibold">
                              {event.fromState ? `${event.fromState} → ` : ""}
                              {event.toState}
                            </p>
                            <p className="text-[8.5px] leading-3.5 text-muted-foreground">
                              {formatDateTime(event.at)}
                              {event.note ? ` · ${event.note}` : ""}
                            </p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  <p className="mt-2 text-[9px] leading-4 text-muted-foreground">
                    State changes are written to the immutable mission event table with timestamps.
                    Telemetry advances every 30 seconds while a mission is active.
                  </p>
                </Section>
              </>
            )}
          </div>
        </div>
      )}

      {tab === "fleet" && (
        <div className="space-y-4">
          <Section
            eyebrow="Uncrewed fleet"
            title="Registered drones"
            action={<span className="text-[10px] text-muted-foreground">{fleet?.length ?? 0} aircraft</span>}
          >
            {fleet === undefined ? (
              <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading fleet…
              </div>
            ) : (
              <div className="space-y-2">
                {fleet.map((drone) => (
                  <div key={drone._id} className="rounded-xl border border-border bg-background p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="flex items-center gap-1.5 text-[11px] font-bold">
                          {drone.droneId} · {drone.model}
                          <span
                            className={cn(
                              "rounded-full px-1.5 py-0.5 text-[8px] font-bold uppercase",
                              drone.status === "available"
                                ? "bg-teal-50 text-teal-700"
                                : drone.status === "charging"
                                  ? "bg-sky-50 text-sky-700"
                                  : "bg-muted text-muted-foreground",
                            )}
                          >
                            {drone.status}
                          </span>
                        </p>
                        <p className="mt-0.5 text-[9.5px] text-muted-foreground">
                          {drone.manufacturer} · {drone.flightController} · {drone.baseName},{" "}
                          {drone.city}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-[9px]">
                        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1">
                          <BatteryCharging className="size-2.5" /> {drone.batteryPct}%
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1">
                          {drone.linkStatus === "online" ? (
                            <Wifi className="size-2.5 text-teal-600" />
                          ) : (
                            <WifiOff className="size-2.5 text-rose-600" />
                          )}
                          {drone.linkStatus}
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1">
                          <Thermometer className="size-2.5" /> {drone.containerTempC} °C
                        </span>
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                      <div className="rounded-lg bg-muted/30 p-1.5 text-[9px]">
                        <p className="text-[8px] uppercase tracking-[0.08em] text-muted-foreground">
                          Payload
                        </p>
                        <p className="font-semibold">{drone.maxPayloadKg} kg</p>
                      </div>
                      <div className="rounded-lg bg-muted/30 p-1.5 text-[9px]">
                        <p className="text-[8px] uppercase tracking-[0.08em] text-muted-foreground">
                          Range
                        </p>
                        <p className="font-semibold">{drone.maxRangeKm} km</p>
                      </div>
                      <div className="rounded-lg bg-muted/30 p-1.5 text-[9px]">
                        <p className="text-[8px] uppercase tracking-[0.08em] text-muted-foreground">
                          Cruise
                        </p>
                        <p className="font-semibold">{drone.cruiseSpeedKmh} km/h</p>
                      </div>
                      <div className="rounded-lg bg-muted/30 p-1.5 text-[9px]">
                        <p className="text-[8px] uppercase tracking-[0.08em] text-muted-foreground">
                          Maintenance
                        </p>
                        <p className="font-semibold capitalize">{drone.maintenanceStatus}</p>
                      </div>
                    </div>
                    {canOperate && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 text-[9px]"
                          onClick={() =>
                            void act(
                              `link-${drone._id}`,
                              () =>
                                updateDrone({
                                  droneId: drone._id,
                                  linkStatus: drone.linkStatus === "online" ? "offline" : "online",
                                }),
                              drone.linkStatus === "online" ? "Link marked offline." : "Link restored.",
                            )
                          }
                          disabled={busy === `link-${drone._id}` || drone.status === "assigned"}
                        >
                          {drone.linkStatus === "online" ? (
                            <WifiOff className="size-3" />
                          ) : (
                            <Wifi className="size-3" />
                          )}
                          {drone.linkStatus === "online" ? "Simulate link loss" : "Restore link"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 text-[9px]"
                          onClick={() =>
                            void act(
                              `maint-${drone._id}`,
                              () =>
                                updateDrone({
                                  droneId: drone._id,
                                  maintenanceStatus:
                                    drone.maintenanceStatus === "ok" ? "due" : "ok",
                                }),
                              "Maintenance status updated.",
                            )
                          }
                          disabled={busy === `maint-${drone._id}`}
                        >
                          <RefreshCcw className="size-3" />
                          {drone.maintenanceStatus === "ok" ? "Flag maintenance due" : "Clear maintenance"}
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section eyebrow="Registration" title="Add a drone base">
              {!canOperate ? (
                <p className="text-[10.5px] text-muted-foreground">View-only.</p>
              ) : (
                <div className="space-y-2">
                  <select
                    value={baseOrg}
                    onChange={(event) => {
                      setBaseOrg(event.target.value);
                      const facility = (facilities ?? []).find(
                        (f) => String(f._id) === event.target.value,
                      );
                      if (facility?.latitude != null) setBaseLat(String(facility.latitude));
                      if (facility?.longitude != null) setBaseLng(String(facility.longitude));
                    }}
                    className="h-8 w-full rounded-lg border border-border bg-background px-2 text-[10px]"
                  >
                    <option value="">Verified facility…</option>
                    {(facilities ?? []).map((f) => (
                      <option key={f._id} value={String(f._id)}>
                        {f.name} · {f.city}
                      </option>
                    ))}
                  </select>
                  <Input
                    value={baseName}
                    onChange={(event) => setBaseName(event.target.value)}
                    placeholder="Base name (e.g. Red Cross Pune drone base)"
                    className="h-8 text-[10.5px]"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      value={baseLat}
                      onChange={(event) => setBaseLat(event.target.value)}
                      placeholder="Latitude"
                      className="h-8 text-[10.5px]"
                    />
                    <Input
                      value={baseLng}
                      onChange={(event) => setBaseLng(event.target.value)}
                      placeholder="Longitude"
                      className="h-8 text-[10.5px]"
                    />
                  </div>
                  <Button
                    size="sm"
                    className="w-full gap-1.5 text-[10px]"
                    disabled={busy === "base" || !baseOrg || baseName.trim().length < 3}
                    onClick={() =>
                      void act(
                        "base",
                        () =>
                          registerBase({
                            organizationId: baseOrg as never,
                            name: baseName,
                            latitude: Number(baseLat),
                            longitude: Number(baseLng),
                          }),
                        "Drone base registered.",
                      )
                    }
                  >
                    <Plus className="size-3" /> Register base
                  </Button>
                  <p className="text-[9px] leading-4 text-muted-foreground">
                    A drone can only fly a transfer whose supplying facility hosts its base.
                  </p>
                </div>
              )}
            </Section>

            <Section eyebrow="Registration" title="Add a drone">
              {!canOperate ? (
                <p className="text-[10.5px] text-muted-foreground">View-only.</p>
              ) : (
                <div className="space-y-2">
                  <select
                    value={droneBase}
                    onChange={(event) => setDroneBase(event.target.value)}
                    className="h-8 w-full rounded-lg border border-border bg-background px-2 text-[10px]"
                  >
                    <option value="">Drone base…</option>
                    {(bases ?? []).map((b) => (
                      <option key={b._id} value={String(b._id)}>
                        {b.name} · {b.city}
                      </option>
                    ))}
                  </select>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      value={droneModel}
                      onChange={(event) => setDroneModel(event.target.value)}
                      placeholder="Model"
                      className="h-8 text-[10.5px]"
                    />
                    <Input
                      value={droneManufacturer}
                      onChange={(event) => setDroneManufacturer(event.target.value)}
                      placeholder="Manufacturer"
                      className="h-8 text-[10.5px]"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      value={dronePayload}
                      onChange={(event) => setDronePayload(event.target.value)}
                      placeholder="Max payload kg"
                      className="h-8 text-[10.5px]"
                    />
                    <Input
                      value={droneCapacity}
                      onChange={(event) => setDroneCapacity(event.target.value)}
                      placeholder="Battery Wh"
                      className="h-8 text-[10.5px]"
                    />
                    <Input
                      value={droneRange}
                      onChange={(event) => setDroneRange(event.target.value)}
                      placeholder="Max range km"
                      className="h-8 text-[10.5px]"
                    />
                    <Input
                      value={droneSpeed}
                      onChange={(event) => setDroneSpeed(event.target.value)}
                      placeholder="Cruise km/h"
                      className="h-8 text-[10.5px]"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      value={droneBattery}
                      onChange={(event) => setDroneBattery(event.target.value)}
                      placeholder="Battery %"
                      className="h-8 text-[10.5px]"
                    />
                    <select
                      value={droneController}
                      onChange={(event) =>
                        setDroneController(event.target.value as "px4" | "ardupilot")
                      }
                      className="h-8 rounded-lg border border-border bg-background px-2 text-[10px]"
                    >
                      <option value="px4">PX4 · SITL</option>
                      <option value="ardupilot">ArduPilot · SITL</option>
                    </select>
                  </div>
                  <Button
                    size="sm"
                    className="w-full gap-1.5 text-[10px]"
                    disabled={busy === "drone" || !droneBase}
                    onClick={() =>
                      void act(
                        "drone",
                        () =>
                          registerDrone({
                            baseId: droneBase as never,
                            model: droneModel,
                            manufacturer: droneManufacturer,
                            maxPayloadKg: Number(dronePayload),
                            batteryCapacityWh: Number(droneCapacity),
                            maxRangeKm: Number(droneRange),
                            cruiseSpeedKmh: Number(droneSpeed),
                            batteryPct: Number(droneBattery),
                            flightController: droneController,
                            maintenanceStatus: "ok",
                          }),
                        "Drone registered in the simulated fleet.",
                      )
                    }
                  >
                    <Plus className="size-3" /> Register drone
                  </Button>
                  <p className="text-[9px] leading-4 text-muted-foreground">
                    Registration records the flight controller type only. No MAVLink connection is
                    opened and no motor command can be sent from the browser.
                  </p>
                </div>
              )}
            </Section>
          </div>
        </div>
      )}

      {tab === "airspace" && (
        <div className="space-y-4">
          <Section
            eyebrow="Route constraints"
            title="Restricted zones (simulated training dataset)"
            action={<span className="text-[10px] text-muted-foreground">{zones?.length ?? 0} zone(s)</span>}
          >
            {zones === undefined ? (
              <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading zones…
              </div>
            ) : (
              <div className="space-y-2">
                {zones.map((zone) => (
                  <div
                    key={zone._id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-background p-3"
                  >
                    <div>
                      <p className="text-[10.5px] font-bold">
                        {zone.name}{" "}
                        <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[8px] font-bold uppercase text-amber-800">
                          {zone.kind}
                        </span>
                      </p>
                      <p className="mt-0.5 text-[9px] text-muted-foreground">
                        {zone.centerLat.toFixed(4)}, {zone.centerLng.toFixed(4)} · {zone.radiusKm} km
                        · {zone.source} · {zone.active ? "active" : "inactive"}
                      </p>
                      {zone.note && (
                        <p className="mt-0.5 text-[8.5px] leading-3.5 text-muted-foreground">
                          {zone.note}
                        </p>
                      )}
                    </div>
                    <ChevronRight className="size-3 text-muted-foreground" />
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section eyebrow="Data entry" title="Add a simulated restricted zone">
            {!canOperate ? (
              <p className="text-[10.5px] text-muted-foreground">View-only.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <Input
                  value={zoneName}
                  onChange={(event) => setZoneName(event.target.value)}
                  placeholder="Zone name"
                  className="h-8 text-[10.5px]"
                />
                <Input
                  value={zoneLat}
                  onChange={(event) => setZoneLat(event.target.value)}
                  placeholder="Latitude"
                  className="h-8 text-[10.5px]"
                />
                <Input
                  value={zoneLng}
                  onChange={(event) => setZoneLng(event.target.value)}
                  placeholder="Longitude"
                  className="h-8 text-[10.5px]"
                />
                <div className="flex gap-2">
                  <Input
                    value={zoneRadius}
                    onChange={(event) => setZoneRadius(event.target.value)}
                    placeholder="Radius km"
                    className="h-8 text-[10.5px]"
                  />
                  <Button
                    size="sm"
                    className="h-8 shrink-0 gap-1 text-[10px]"
                    disabled={busy === "zone" || zoneName.trim().length < 3}
                    onClick={() =>
                      void act(
                        "zone",
                        () =>
                          addZone({
                            name: zoneName,
                            kind: "restricted",
                            centerLat: Number(zoneLat),
                            centerLng: Number(zoneLng),
                            radiusKm: Number(zoneRadius),
                            source: "simulated",
                            note: "Training restriction. Not an authoritative aeronautical dataset.",
                          }),
                        "Simulated zone added. New plans will check it.",
                      )
                    }
                  >
                    <Plus className="size-3" /> Add
                  </Button>
                </div>
              </div>
            )}
            <p className="mt-2 text-[9px] leading-4 text-muted-foreground">
              Preflight fails when any route waypoint falls inside a restricted zone. This dataset is
              for software testing only; real flights need authoritative airspace data, NOTAMs and
              written approvals.
            </p>
          </Section>
        </div>
      )}
    </DashboardShell>
  );
}
